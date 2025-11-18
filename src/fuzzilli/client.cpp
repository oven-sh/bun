#include "log.hpp"
#include <cstring>
#ifdef BUN_FUZZILLI_ENABLED

#include "client.hpp"

#include <cstdlib>
#include <string_view>
#include <unistd.h>

namespace bun::fuzzilli {

Client::Client(Log& log, ClientConfig config)
    : m_config(std::move(config)),
      m_log(log)
{
}

Client::~Client()
{
}

std::size_t Client::forceRead(int fd, std::span<char> buffer, std::size_t maxBytes)
{
    const ssize_t res = read(fd, buffer.data(), maxBytes);
    if (res < 0) {
        m_log << "Error reading from fd " << fd << " -- " << strerror(errno) << "\n";
        std::abort();
    }

    return static_cast<std::size_t>(res);
}

void Client::forceWrite(int fd, std::string_view data)
{
    const int written = write(fd, data.data(), data.size());
    if (written != static_cast<int>(data.size())) {
        m_log << "Error writing to fd " << fd << "\n";
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
