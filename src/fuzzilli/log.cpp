#include "log.hpp"

namespace bun::fuzzilli {

Log::Log(std::filesystem::path const& path)
    : m_fd([&]() {
        const int fd = open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC, S_IRUSR | S_IWUSR);
        if (fd < 0) [[unlikely]] {
            std::abort();
        }
        return fd;
    }())
{
}

Log& Log::operator<<(std::string_view message)
{
    const auto forceWrite = [this](std::string_view message) {
        const ssize_t bytesWritten = write(m_fd, message.data(), message.size());
        if (bytesWritten < 0 || static_cast<size_t>(bytesWritten) != message.size()) [[unlikely]] {
            std::abort();
        }
    };

    forceWrite(message);
    fsync(m_fd);

    return *this;
}

Log& Log::operator<<(std::int64_t message)
{
    return (*this << std::to_string(message));
}

} // namespace bun::fuzzilli
