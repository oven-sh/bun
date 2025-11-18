#pragma once

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
    Client(ClientConfig config = ClientConfig::defaultConfig());
    ~Client();

    void sendCommand(std::string_view);
    void sendData(std::string_view);

    template <typename It>
    void receiveFd(It it, int fd, std::size_t maxSize) {
        static constexpr std::size_t bufSize = 128;
        std::array<char, bufSize> buffer;

        std::size_t written = 0;
        std::size_t count = 0;
        while ((count = forceRead(fd, buffer)) > 0)
        {
            if (written + count > maxSize) {
                // TODO(markovejnovic): Log
                std::abort();
            }
            std::ranges::copy_n(buffer.begin(), count, it);
            written += count;
        }
    }

    template <typename It>
    void receiveCommand(It it, std::size_t maxSize = defaultMaxCmdSize) {
        receiveFd(it, m_config.commandReadFD, maxSize);
    }

    template <typename It>
    void receiveData(It it, std::size_t maxSize = defaultMaxDataSize) {
        receiveFd(it, m_config.dataReadFD, maxSize);
    }

private:
    static std::size_t forceRead(int fd, std::span<char> buffer);
    static void forceWrite(int fd, std::string_view data);

    ClientConfig m_config;
};

} // namespace bun::fuzzilli
