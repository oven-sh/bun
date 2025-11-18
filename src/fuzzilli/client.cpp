#ifdef BUN_FUZZILLI_ENABLED

#include "client.hpp"

#include <cstdlib>
#include <string_view>
#include <unistd.h>

namespace bun::fuzzilli {

Client::Client(ClientConfig config)
    : m_config(std::move(config))
{
}

Client::~Client()
{
}

std::size_t Client::forceRead(int fd, std::span<char> buffer)
{
    const ssize_t res = read(fd, buffer.data(), buffer.size());
    if (res < 0) {
        // TODO(markovejnovic): Log
        std::abort();
    }

    return static_cast<std::size_t>(res);
}

void Client::forceWrite(int fd, std::string_view data)
{
    const int written = write(fd, data.data(), data.size());
    if (written != static_cast<int>(data.size())) {
        // TODO(markovejnovic): Log
        std::abort();
    }
}

void Client::sendCommand(std::string_view command)
{
    forceWrite(m_config.commandWriteFD, command);
}

void Client::sendData(std::string_view data)
{
    forceWrite(m_config.dataWriteFD, data);
}

} // namespace bun::fuzzilli

#endif // BUN_FUZZILLI_ENABLED
