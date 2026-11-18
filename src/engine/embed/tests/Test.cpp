#include "Test.h"

#include <csignal>
#include <fcntl.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

namespace Test {

static Case* firstCase;
static unsigned failureCount;

Case::Case(const char* name, void (*run)())
    : name(name)
    , run(run)
    , next(std::exchange(firstCase, this))
{
}

void fail(const char* file, int line, const char* text)
{
    fprintf(stderr, "%s:%d: expected %s\n", file, line, text);
    ++failureCount;
}

bool crashes(const ScopedLambda<void()>& code)
{
    pid_t child = fork();
    if (!child) {
        rlimit noCore {};
        setrlimit(RLIMIT_CORE, &noCore);
        dup2(open("/dev/null", O_WRONLY), STDERR_FILENO);
        code();
        _exit(0);
    }
    int status;
    waitpid(child, &status, 0);
    // A report of a sanitizer ends in an exit code.
    return WIFSIGNALED(status) && (WTERMSIG(status) == SIGABRT || WTERMSIG(status) == SIGTRAP);
}

}

extern "C" const char* __asan_default_options()
{
    // The collector looks for cells on the real stack.
    return "allocator_may_return_null=1:abort_on_error=0:detect_stack_use_after_return=0";
}

int main(int argumentCount, char** arguments)
{
    const char* filter = argumentCount > 1 ? arguments[1] : "";
    unsigned count = 0;
    for (auto* test = Test::firstCase; test; test = test->next) {
        if (!strstr(test->name, filter))
            continue;
        unsigned failuresBefore = Test::failureCount;
        test->run();
        ++count;
        if (Test::failureCount != failuresBefore)
            fprintf(stderr, "FAIL %s\n", test->name);
    }
    printf("%u tests, %u failed expectations\n", count, Test::failureCount);
    return Test::failureCount || !count;
}
