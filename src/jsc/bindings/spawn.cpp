#ifndef WIN32

#include <spawn.h>
#include <signal.h>

extern "C" int posix_spawnattr_reset_signals(posix_spawnattr_t* attr)
{
    sigset_t signal_set;
    sigfillset(&signal_set);
    if (posix_spawnattr_setsigdefault(attr, &signal_set) != 0) {
        return 1;
    }

    sigemptyset(&signal_set);
    if (posix_spawnattr_setsigmask(attr, &signal_set) != 0) {
        return 1;
    }

    return 0;
}

#endif
