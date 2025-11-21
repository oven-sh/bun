#pragma once

#include <filesystem>

namespace bun::fuzzilli {

class Log {
public:
    constexpr Log(int fd)
        : m_fd(fd)
    {
    }
    Log(std::filesystem::path const& path);
    Log& operator<<(std::string_view message);
    Log& operator<<(std::int64_t message);

    Log(const Log&) = delete;
    Log& operator=(const Log&) = delete;
    Log(Log&&) = delete;
    Log& operator=(Log&&) = delete;

private:
    int m_fd;
};

} // namespace bun::fuzzilli
