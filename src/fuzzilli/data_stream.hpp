#pragma once

#include <memory>
#include <streambuf>
#include <variant>

namespace bun::fuzzilli {

/// @brief Represents the stream of data exchanged by fuzzilli and bun.
/// Fuzzilli will send us data through this stream.
struct DataStreamBuf : public std::streambuf {};

struct MmapDataStreamBuf : public DataStreamBuf {
private:
    static constexpr std::size_t reprlMaxDataSize = 16 << 20;

    char* m_mapping = nullptr;

public:
    MmapDataStreamBuf(int fd);
    ~MmapDataStreamBuf();
};

/// @note This borrows the file descriptor; it does not take ownership of it.
struct FileDataStreamBuf : public DataStreamBuf {
    constexpr FileDataStreamBuf(int fd) : m_fd(fd) {}

private:
    int m_fd;
};

struct DataStream {
public:
    /// @brief Create the fuzzilli DataStream from the environment.
    ///
    /// Reads `envp["SHM_ID"]` to determine whether to use shared memory or a file descriptor.
    /// If `SHM_ID` is set, uses shared memory; otherwise, falls back to file descriptor.
    ///
    /// @note Borrows the file descriptor.
    static DataStream fromEnv(int dataReadFd);
private:
    constexpr DataStream(std::unique_ptr<DataStreamBuf>&& buf) : m_buf(std::move(buf)) {};

    std::unique_ptr<DataStreamBuf> m_buf;
};

} // namespace bun::fuzzilli
