// Runs a program one instruction at a time and counts the calls from Bun's own code into Bun's own code: how many different functions are called,
// and how many different functions the one call instruction with the most of them calls. Linux on x64. No header: bun:ffi compiles this where none is installed.

long ptrace(long request, ...);
int fork(void);
int execv(const char* path, char* const* arguments);
int waitpid(int pid, int* status, int options);
int open(const char* path, int flags, ...);
long read(int file, void* bytes, unsigned long count);
int close(int file);
int dup2(int from, int to);
void _exit(int status);
int kill(int pid, int signal);

enum { TraceMe = 0, SingleStep = 9, GetRegisters = 12, Trap = 5, Kill = 9 };
enum { InstructionPointer = 16, StackPointer = 19, NumberOfRegisters = 27 };
enum { LongestInstruction = 15 };

#define NUMBER_OF_SLOTS (1 << 18)

typedef struct {
    unsigned long first[NUMBER_OF_SLOTS];
    unsigned long second[NUMBER_OF_SLOTS];
    unsigned long count[NUMBER_OF_SLOTS];
    unsigned long used;
} Table;

static Table calls;
static Table callers;
static Table functions;

static void clear(Table* table)
{
    for (unsigned long slot = 0; slot < NUMBER_OF_SLOTS; slot++)
        table->first[slot] = table->second[slot] = table->count[slot] = 0;
    table->used = 0;
}

// The slot of the pair, and in isNew whether this call added it. No slot once half are used.
static long find(Table* table, unsigned long first, unsigned long second, int* isNew)
{
    unsigned long slot = ((first * 0x9e3779b97f4a7c15ul) ^ (second * 0xc2b2ae3d27d4eb4ful)) >> 40;
    for (;; slot++) {
        slot &= NUMBER_OF_SLOTS - 1;
        if (table->first[slot] == first && table->second[slot] == second) {
            *isNew = 0;
            return slot;
        }
        if (!table->first[slot])
            break;
    }
    if (table->used * 2 >= NUMBER_OF_SLOTS)
        return -1;
    table->used++;
    table->first[slot] = first;
    table->second[slot] = second;
    *isNew = 1;
    return slot;
}

enum { MostPiecesOfCode = 64 };
static unsigned long startOfCode[MostPiecesOfCode], endOfCode[MostPiecesOfCode];
static int piecesOfCode;

static int isCode(unsigned long address)
{
    for (int piece = 0; piece < piecesOfCode; piece++) {
        if (address >= startOfCode[piece] && address < endOfCode[piece])
            return 1;
    }
    return 0;
}

static const char* fileOf(const char* line)
{
    while (*line && *line != '\n' && *line != '/')
        line++;
    return line;
}

static int isSameFile(const char* left, const char* right)
{
    while (*left == *right && *left && *left != '\n')
        left++, right++;
    return *left == *right;
}

// The first mapping of a process that has just begun is of its executable. An executable that was built without part of Bun has Bun's code in several pieces.
static int findCode(int pid)
{
    char path[32] = "/proc/";
    char digits[12];
    int length = 0, at = 6;
    for (int rest = pid; rest; rest /= 10)
        digits[length++] = '0' + rest % 10;
    while (length)
        path[at++] = digits[--length];
    for (const char* tail = "/maps"; *tail; tail++)
        path[at++] = *tail;
    path[at] = 0;

    static char text[1 << 16];
    int file = open(path, 0);
    if (file < 0)
        return 0;
    long size = 0, got;
    while (size < (long)sizeof(text) - 1 && (got = read(file, text + size, sizeof(text) - 1 - size)) > 0)
        size += got;
    close(file);
    text[size] = 0;

    piecesOfCode = 0;
    for (char* line = text; *line;) {
        unsigned long bounds[2] = { 0, 0 };
        char* cursor = line;
        for (int which = 0; which < 2; which++, cursor++) {
            for (; (*cursor >= '0' && *cursor <= '9') || (*cursor >= 'a' && *cursor <= 'f'); cursor++)
                bounds[which] = bounds[which] * 16 + (*cursor <= '9' ? *cursor - '0' : *cursor - 'a' + 10);
        }
        if (cursor[2] == 'x' && isSameFile(fileOf(line), fileOf(text)) && piecesOfCode < MostPiecesOfCode) {
            startOfCode[piecesOfCode] = bounds[0];
            endOfCode[piecesOfCode++] = bounds[1];
        }
        while (*line && *line++ != '\n') { }
    }
    return piecesOfCode;
}

// A container may refuse it.
int canTrace(void)
{
    int child = fork();
    if (child < 0)
        return 0;
    if (!child)
        _exit(ptrace(TraceMe, 0, 0, 0) < 0 ? 126 : 0);
    int status = 0;
    return waitpid(child, &status, 0) == child && !status;
}

// counts: instructions, different functions called, different functions called by the one call with the most. Answers 0, or what went wrong.
int countCallsOfStart(const char* path, unsigned long* counts)
{
    clear(&calls);
    clear(&callers);
    clear(&functions);
    counts[0] = counts[1] = counts[2] = 0;

    int child = fork();
    if (child < 0)
        return 1;
    if (!child) {
        char* arguments[2] = { (char*)path, 0 };
        int nowhere = open("/dev/null", 1);
        dup2(nowhere, 1);
        if (ptrace(TraceMe, 0, 0, 0) < 0)
            _exit(126);
        execv(path, arguments);
        _exit(127);
    }

    int status = 0;
    if (waitpid(child, &status, 0) < 0 || (status & 0xff) != 0x7f)
        return 2;
    if (!findCode(child)) {
        kill(child, Kill);
        waitpid(child, &status, 0);
        return 3;
    }

    unsigned long registers[NumberOfRegisters];
    unsigned long caller = 0, stackOfCaller = 0;
    long signalToDeliver = 0;
    for (;;) {
        if (ptrace(SingleStep, child, 0, signalToDeliver) < 0)
            return 4;
        if (waitpid(child, &status, 0) < 0)
            return 5;
        if ((status & 0xff) != 0x7f)
            return (status & 0x7f) || (status >> 8 & 0xff) ? 6 : 0;
        int signal = status >> 8 & 0xff;
        signalToDeliver = signal == Trap ? 0 : signal;
        if (ptrace(GetRegisters, child, 0, registers) < 0)
            return 7;

        unsigned long at = registers[InstructionPointer], stack = registers[StackPointer];
        counts[0]++;
        // A call pushes one word and goes elsewhere. A push goes on to the next instruction.
        int isCall = stack == stackOfCaller - 8 && at - caller - 1 >= LongestInstruction;
        if (isCall && isCode(at) && isCode(caller)) {
            int isNew;
            if (find(&functions, at, 0, &isNew) < 0)
                return 8;
            counts[1] += isNew;
            if (find(&calls, caller, at, &isNew) < 0)
                return 8;
            if (isNew) {
                long slot = find(&callers, caller, 0, &isNew);
                if (slot < 0)
                    return 8;
                if (++callers.count[slot] > counts[2])
                    counts[2] = callers.count[slot];
            }
        }
        caller = at;
        stackOfCaller = stack;
    }
}
