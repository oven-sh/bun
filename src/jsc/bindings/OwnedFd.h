#pragma once

#include "root.h"

#if !OS(WINDOWS)
#include <unistd.h>

namespace Bun {

class OwnedFd {
    WTF_MAKE_NONCOPYABLE(OwnedFd);

public:
    // Takes what `open()` and the like return: a negative value is no descriptor.
    explicit OwnedFd(int fd)
        : m_fd(fd)
    {
    }
    ~OwnedFd()
    {
        if (m_fd >= 0)
            ::close(m_fd);
    }

    explicit operator bool() const { return m_fd >= 0; }
    int get() const { return m_fd; }
    void leak() { m_fd = -1; }

private:
    int m_fd;
};

} // namespace Bun
#endif
