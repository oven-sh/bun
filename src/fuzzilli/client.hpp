#pragma once

#include "log.hpp"
#include <array>
#include <string_view>
#include <span>
#include <ranges>

namespace bun::fuzzilli {

struct ClientConfig {
    int commandReadFD;
    int commandWriteFD;
    int dataReadFD;
    int dataWriteFD;

    static constexpr ClientConfig defaultConfig()
    {
        return {
            .commandReadFD = 100,
            .commandWriteFD = 101,
            .dataReadFD = 102,
            .dataWriteFD = 103,
        };
    }
};

/// @brief A client that connects to the Fuzzilli runner.
class Client {
private:
    static constexpr auto defaultMaxCmdSize = 4 * 1024;
    static constexpr auto defaultMaxDataSize = 4 * 1024 * 1024;

public:
    Client(Log& log, ClientConfig config = ClientConfig::defaultConfig());
    ~Client();

    void sendCommand(std::string_view);
    void sendData(std::string_view);

    template <typename It>
    std::size_t receiveFd(It it, int fd, std::size_t numBytes) {
        static constexpr std::size_t bufSize = 128;
        std::array<char, bufSize> buffer;

        std::size_t written = 0;
        while (written < numBytes) {
            std::size_t toRead = std::min(bufSize, numBytes - written);
            std::size_t count = forceRead(fd, buffer, toRead);

            if (count == 0) break;  // EOF or error

            it = std::ranges::copy_n(buffer.begin(), count, it).out;
            written += count;
        }

        return written;
    }

    template <typename It>
    std::size_t receiveCommand(It it, std::size_t maxSize = defaultMaxCmdSize) {
        m_log << "Receiving command up to " << maxSize << " bytes\n";
        return receiveFd(it, m_config.commandReadFD, maxSize);
    }

    template <typename It>
    std::size_t receiveData(It it, std::size_t maxSize = defaultMaxDataSize) {
        m_log << "Receiving data up to " << maxSize << " bytes\n";
        return receiveFd(it, m_config.dataReadFD, maxSize);
    }

private:
    std::size_t forceRead(int fd, std::span<char> buffer, std::size_t maxBytes);
    void forceWrite(int fd, std::string_view data);

    ClientConfig m_config;
    Log& m_log;
};

} // namespace bun::fuzzilli
