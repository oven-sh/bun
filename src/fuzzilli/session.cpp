#include "log.hpp"
#include <unistd.h>
#include <fcntl.h>
#include <cstring>

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
    FuzzilliSession() noexcept {
        exchangeHelo();
    }

    ~FuzzilliSession() {}

private:
    Log m_log { "/tmp/fuzzilli-bun.log" };

    Client m_client { m_log };

    void exchangeHelo() {
        m_log << "[Session] Starting HELO exchange\n";
        m_client.sendCommand(heloMessage);
        m_log << "[Session] Sent HELO to Fuzzilli\n";

        std::string response(heloMessage.size(), '\0');
        response.resize(m_client.receiveCommand(response.begin(), heloMessage.size()));
        m_log << "[Session] Received HELO response from Fuzzilli: '" << response << "' (length: " << response.size() << ")\n";

        if (response != heloMessage) {
            m_log << "[Session] ERROR: Invalid HELO response from Fuzzilli: '" << response << "'\n";
            std::abort();
        }

        m_log << "[Session] HELO exchange completed successfully\n";
    }
};

} // namespace bun::fuzzilli

// Type definition for the Zig callback
using ExecuteCallback = int (*)(const char* script, size_t length);

// Global callback pointer set by Zig
static ExecuteCallback g_execute_callback = nullptr;

extern "C" void bun__fuzzilli__begin_with_global(void* callback_ptr) {
    fprintf(stderr, "[C++] bun__fuzzilli__begin_with_global() entered\n");
    fflush(stderr);

    g_execute_callback = reinterpret_cast<ExecuteCallback>(callback_ptr);
    if (!g_execute_callback) {
        fprintf(stderr, "[C++] ERROR: Execute callback is null!\n");
        _exit(-1);
    }

    bun::fuzzilli::Log log("/tmp/fuzzilli-bun.log");

    log << "[Main] ========================================\n";
    log << "[Main] bun__fuzzilli__begin() called\n";
    log << "[Main] ========================================\n";

    fprintf(stderr, "[C++] About to create FuzzilliSession\n");
    fflush(stderr);

    log << "[Main] Creating FuzzilliSession for HELO exchange\n";
    bun::fuzzilli::FuzzilliSession session;
    log << "[Main] FuzzilliSession created successfully\n";

    fprintf(stderr, "[C++] FuzzilliSession created\n");
    fflush(stderr);

    static constexpr auto REPRL_CRFD = 100;
    static constexpr auto REPRL_CWFD = 101;
    static constexpr auto REPRL_DRFD = 102;

    log << "[Main] Entering REPRL loop\n";
    log << "[Main] REPRL FDs - CRFD: " << REPRL_CRFD << ", CWFD: " << REPRL_CWFD << ", DRFD: " << REPRL_DRFD << "\n";

    int iteration = 0;
    while (true) {
        iteration++;
        log << "[Loop] ==================== Iteration " << iteration << " ====================\n";

        // Check if control FD is still valid
        int fd_status = fcntl(REPRL_CRFD, F_GETFL);
        if (fd_status == -1) {
            log << "[Loop] ERROR: Control FD is invalid, errno: " << errno << " (" << strerror(errno) << ")\n";
            _exit(-1);
        }

        // Read action (4 bytes, should be 'exec' = 0x63657865)
        unsigned action = 0;
        ssize_t nread = read(REPRL_CRFD, &action, 4);
        log << "[Loop] Read action: " << nread << " bytes\n";

        fflush(0);
        if (nread != 4 || action != 0x63657865) { // 'exec'
            log << "[Loop] ERROR: Unknown action (expected 'exec'), nread=" << nread << "\n";
            _exit(-1);
        }
        log << "[Loop] Received 'exec' action\n";

        // Read script size (8 bytes)
        size_t script_size = 0;
        nread = read(REPRL_CRFD, &script_size, 8);
        log << "[Loop] Read script size: " << nread << " bytes, size: " << script_size << " bytes\n";

        if (nread != 8) {
            log << "[Loop] ERROR: Failed to read script size (got " << nread << " bytes instead of 8)\n";
            _exit(-1);
        }

        if (script_size > 10 * 1024 * 1024) {  // 10MB sanity check
            log << "[Loop] WARNING: Very large script size: " << script_size << " bytes\n";
        }

        // Allocate buffer for script
        char* buf = reinterpret_cast<char*>(malloc(script_size + 1));
        if (!buf) {
            log << "[Loop] ERROR: Failed to allocate " << script_size << " bytes for script\n";
            _exit(-1);
        }

        memset(buf, 0, script_size + 1);

        // Read script data
        char* source_buffer_tail = buf;
        ssize_t remaining = static_cast<ssize_t>(script_size);
        log << "[Loop] Reading " << remaining << " bytes of script data from FD " << REPRL_DRFD << "\n";

        size_t total_read = 0;
        while (remaining > 0) {
            ssize_t rv = read(REPRL_DRFD, source_buffer_tail, static_cast<size_t>(remaining));
            log << "[Loop]   Read chunk: " << rv << " bytes (remaining: " << remaining << ", total read: " << total_read << ")\n";

            if (rv <= 0) {
                log << "[Loop] ERROR: Failed to read script data (rv=" << rv << ", errno=" << errno << ": " << strerror(errno) << ")\n";
                free(buf);
                _exit(-1);
            }
            remaining -= rv;
            source_buffer_tail += rv;
            total_read += rv;
        }

        buf[script_size] = '\0';
        log << "[Loop] Script data read successfully (total: " << total_read << " bytes)\n";

        if (script_size > 0) {
            size_t preview_len = std::min(script_size, size_t(200));
            log << "[Loop] Script preview (first " << preview_len << " chars): " << std::string_view(buf, preview_len);
            if (script_size > preview_len) {
                log << "...";
            }
            log << "\n";
        }

        // Execute the script via Zig callback
        log << "[Loop] Calling Zig execute callback\n";
        int status = g_execute_callback(buf, script_size);

        // Clean up the script buffer
        free(buf);
        log << "[Loop] Freed script buffer\n";

        log << "[Loop] Execution status: " << status << "\n";

        // Send back the status to Fuzzilli (4 bytes as per REPRL protocol)
        log << "[Loop] Sending status " << status << " to Fuzzilli on FD " << REPRL_CWFD << "\n";
        ssize_t status_written = write(REPRL_CWFD, &status, 4);
        if (status_written != 4) {
            log << "[Loop] ERROR: Failed to write status (wrote " << status_written << " bytes instead of 4)\n";
            _exit(1);
        }
        log << "[Loop] Status sent successfully (" << status_written << " bytes)\n";
        log << "[Loop] Iteration " << iteration << " complete\n";
    }
}
