#include "log.hpp"
#include <unistd.h>

#include "session.hpp"
#include "client.hpp"
#include "reprl.hpp"

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

    Client m_client { m_log };

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
    bun::fuzzilli::Reprl reprl;

    while (true) {
        static constexpr auto REPRL_CRFD = 100;
        static constexpr auto REPRL_DRFD = 102;

        int fd_status = fcntl(REPRL_CRFD, F_GETFL);
        if (fd_status == -1) {
            _exit(-1);
        }
        unsigned action = 0;
        ssize_t nread = read(REPRL_CRFD, &action, 4);
        fflush(0);
        if (nread != 4 || action != 0x63657865) { // 'exec'
          fprintf(stderr, "Unknown action %x\n", action);
          _exit(-1);
        }
        size_t script_size = 0;
        read(REPRL_CRFD, &script_size, 8);

        char* buf = reinterpret_cast<char*>(malloc(script_size + 1));
        memset(buf,0,script_size + 1);
        char* source_buffer_tail = buf;
        ssize_t remaining = (ssize_t) script_size;
        while (remaining > 0) {
          ssize_t rv = read(REPRL_DRFD, source_buffer_tail, (size_t) remaining);
          if (rv <= 0) {
            fprintf(stderr, "Failed to load script\n");
            _exit(-1);
          }
          remaining -= rv;
          source_buffer_tail += rv;
        }

        buf[script_size] = '\0';

        // Execute the JavaScript code
        int status = reprl.execute(std::string_view(buf, script_size));

        // Clean up the buffer
        free(buf);

        // Reset the VM for the next execution
        reprl.reset();

        // Send back the status to Fuzzilli (4 bytes as per REPRL protocol)
        static constexpr auto REPRL_CWFD = 101;
        if (write(REPRL_CWFD, &status, 4) != 4) {
            _exit(1);
        }
    }
}
