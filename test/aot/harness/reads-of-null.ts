// Programs whose reads of null and undefined are loads that fault, for the tests on what becomes of the signal, and a process that counts the signals.

export const compiler = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// A reader that is copied into the `try` of its caller would find null by a comparison. A function that may call itself is copied all the same where the call knows it, so the callers
// call the readers off a list that holds five functions: of so many the build keeps no account, and the call stays a call of a value.
export const callsItself = `const callsItself = process.argv.length > 100;
`;

// Compiled code leaves the test for null to the load where it has proved that what it reads through is an object, null or undefined, and cannot tell which:
// a field of a class, the end of a chain, what a Map lacks, a variable in which two ways meet. A value that it knows nothing about it compares: one out of JSON.parse(),
// and a parameter, where the program calls a function that the build has not read.
export const readers = `${callsItself}class Point { constructor(public x: number) {} }
class Place { point: Point | null = null; next: Place | null = null; id = 1; }
const place = new Place();
const points = new Map<number, Point>();
let isFilled = false;
function fill() { place.point = new Point(1); place.next = new Place(); points.set(1, new Point(2)); isFilled = true; }
if (callsItself) fill();
function inAField(): number { return callsItself ? inAField() : place.point!.x; }
function atTheEndOfAChain(): number { return callsItself ? atTheEndOfAChain() : place.next!.id; }
function lackedByAMap(): number { return callsItself ? lackedByAMap() : points.get(1)!.x; }
function inAVariable(): number {
  if (callsItself) return inAVariable();
  let point: Point | null = null;
  if (isFilled) point = new Point(3);
  return point!.x;
}
const readers = [inAField, atTheEndOfAChain, lackedByAMap, inAVariable, fill];
`;

// Runs a program until it stands at the instruction of its first null check again, after all of them, and sends it SIGSEGV there
// as another process would, with sigqueue(). How many of its reads of null a program finds by such an instruction is the compiler's choice:
// without $CHECKS it runs the program to its end and prints their number.
export const sender = `#define _GNU_SOURCE
#include <elf.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ptrace.h>
#include <sys/uio.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

#if defined(__x86_64__)
#define PC(registers) (registers).rip
static const unsigned long trap = 0xcc, trap_mask = 0xff, trap_length = 1;
#else
#define PC(registers) (registers).pc
static const unsigned long trap = 0xd4200000, trap_mask = 0xffffffff, trap_length = 0;
#endif

int main(int argc, char** argv)
{
    pid_t child = fork();
    if (!child) {
        if (ptrace(PTRACE_TRACEME, 0, 0, 0)) _exit(126);
        execv(argv[1], argv + 1);
        _exit(127);
    }
    unsigned long site = 0, word = 0;
    int checks = 0, status, all = getenv("CHECKS") ? atoi(getenv("CHECKS")) : -1;
    struct user_regs_struct registers;
    struct iovec io = { &registers, sizeof registers };
    for (;;) {
        if (waitpid(child, &status, 0) < 0) return 125;
        if (WIFEXITED(status)) { if (all < 0) printf("%d\\n", checks); return WEXITSTATUS(status); }
        if (WIFSIGNALED(status)) { printf("ended by signal %d\\n", WTERMSIG(status)); return 0; }
        int signal_number = WSTOPSIG(status);
        if (signal_number == SIGSEGV && (all < 0 || checks < all)) {
            if (!checks++) { ptrace(PTRACE_GETREGSET, child, NT_PRSTATUS, &io); site = PC(registers); }
            if (checks == all) { word = ptrace(PTRACE_PEEKTEXT, child, site, 0); ptrace(PTRACE_POKETEXT, child, site, (word & ~trap_mask) | trap); }
        } else if (signal_number == SIGTRAP) {
            signal_number = 0;
            ptrace(PTRACE_GETREGSET, child, NT_PRSTATUS, &io);
            if (checks == all && PC(registers) - trap_length == site) {
                ptrace(PTRACE_POKETEXT, child, site, word);
                PC(registers) = site;
                ptrace(PTRACE_SETREGSET, child, NT_PRSTATUS, &io);
                siginfo_t info;
                memset(&info, 0, sizeof info);
                info.si_signo = signal_number = SIGSEGV;
                info.si_code = SI_QUEUE;
                info.si_pid = 5;
                ptrace(PTRACE_SETSIGINFO, child, 0, &info);
                checks++;
            }
        }
        ptrace(PTRACE_CONT, child, 0, signal_number);
    }
}
`;
