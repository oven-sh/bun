#include "log.hpp"
#include <unistd.h>

#include "session.hpp"
#include "client.hpp"

#include <string_view>

namespace bun::fuzzilli {

/// @brief Represents a long-running Fuzzilli session.
///
/// Fuzzilli will instantiate ONE bun instance, and this class manages that. Note that the same bun
/// instance will be used for multiple fuzzing inputs.
class FuzzilliSession {
private:
    static constexpr std::string_view heloMessage = "HELO";

public:
    constexpr FuzzilliSession() noexcept {
        exchangeHelo();
    }

    ~FuzzilliSession() {}

private:
    Log m_log { "/tmp/fuzzilli-bun.log" };

    Client m_client {
        m_log,
        ClientConfig {
            .commandReadFD = STDIN_FILENO,
            .commandWriteFD = STDOUT_FILENO,
            .dataReadFD = STDIN_FILENO,
            .dataWriteFD = STDOUT_FILENO,
        }
    };

    void exchangeHelo() {
        m_client.sendCommand(heloMessage);
        m_log << "Sent HELO to Fuzzilli\n";

        std::string response(heloMessage.size(), '\0');
        response.resize(m_client.receiveCommand(response.begin(), heloMessage.size()));
        m_log << "Received HELO response from Fuzzilli: " << response << "\n";
        if (response != heloMessage) {
            m_log << "Invalid HELO response from Fuzzilli: " << response << "\n";
            std::abort();
        }
    }
};

} // namespace bun::fuzzilli

extern "C" void bun__fuzzilli__begin() {
    bun::fuzzilli::FuzzilliSession run;
}
