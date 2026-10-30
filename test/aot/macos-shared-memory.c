// What macOS does with POSIX shared memory.
#include <fcntl.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <stdio.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

static void say(const char* what, int answer)
{
    dprintf(1, "%s: %s\n", what, answer ? "yes" : "no");
}

static void* map(int descriptor, size_t size, int access, int flags)
{
    void* view = mmap(NULL, size, access, flags, descriptor, 0);
    return view == MAP_FAILED ? NULL : view;
}

void ask(void)
{
    size_t page = getpagesize();
    // Mach copies a few pages at once, whatever they are.
    size_t size = 256 * page;
    char byte = 0;

    const char* longName = "/bun-test-a-name-of-32-bytes-xxx";
    int named = shm_open(longName, O_RDWR | O_CREAT | O_EXCL, 0600);
    say("a name of 32 bytes", named >= 0);
    if (named >= 0)
        shm_unlink(longName);

    char name[32];
    snprintf(name, sizeof(name), "/bun-test-%d", getpid());
    int descriptor = shm_open(name, O_RDWR | O_CREAT | O_EXCL, 0600);
    shm_unlink(name);
    say("ftruncate", !ftruncate(descriptor, size - page + 1));
    struct stat status;
    fstat(descriptor, &status);
    say("st_size as ftruncate was given it", (size_t)status.st_size == size - page + 1);
    say("st_size rounded up to a page", (size_t)status.st_size == size);
    say("a second ftruncate", !ftruncate(descriptor, size));
    say("write", write(descriptor, &byte, 1) == 1);
    say("pwrite", pwrite(descriptor, &byte, 1, 0) == 1);
    say("read", read(descriptor, &byte, 1) == 1);
    say("pread", pread(descriptor, &byte, 1, 0) == 1);

    say("a private view", !!map(descriptor, size, PROT_READ, MAP_PRIVATE));
    char* written = map(descriptor, size, PROT_READ | PROT_WRITE, MAP_SHARED);
    say("a shared view that can be written", !!written);
    say("a shared view that can be executed", !!map(descriptor, size, PROT_READ | PROT_EXEC, MAP_SHARED));
    void* view = map(descriptor, size, PROT_READ, MAP_SHARED);
    mach_vm_address_t address = (mach_vm_address_t)view;
    say("mprotect of a shared view to executable", !mprotect(view, size, PROT_READ | PROT_EXEC));
    say("a higher maximum for a shared view", mach_vm_protect(mach_task_self(), address, size, 1, VM_PROT_READ | VM_PROT_EXECUTE) == KERN_SUCCESS);

    // New memory may be executed. It is of use if it holds the pages of the shared memory until one side writes.
    written[0] = 1;
    vm_offset_t copy = 0;
    mach_msg_type_number_t copied = 0;
    say("mach_vm_read of a shared view", mach_vm_read(mach_task_self(), address, size, &copy, &copied) == KERN_SUCCESS);
    struct vm_page_info_basic info = { 0 };
    mach_msg_type_number_t count = VM_PAGE_INFO_BASIC_COUNT;
    mach_vm_page_info(mach_task_self(), copy, VM_PAGE_INFO_BASIC, (vm_page_info_t)&info, &count);
    say("a copy that shares the pages", ((char*)copy)[0] == 1 && info.depth > 0);
}
