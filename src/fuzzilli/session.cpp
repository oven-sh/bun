#ifdef BUN_FUZZILLI_ENABLED

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
    Client m_client { ClientConfig {
        .commandReadFD = 1,
        .commandWriteFD = 1,
        .dataReadFD = 0,
        .dataWriteFD = 1,
    }};

    void exchangeHelo() {
        m_client.sendCommand(heloMessage);

        std::string response;
        response.reserve(heloMessage.size());
        m_client.receiveCommand(response.begin(), response.size());
        if (response != heloMessage) {
            // TODO(markovejnovic): Log
            std::abort();
        }
    }
};

} // namespace bun::fuzzilli

extern "C" void bun__fuzzilli__begin() {
    bun::fuzzilli::FuzzilliSession run;
}

#endif // BUN_FUZZILLI_ENABLED
