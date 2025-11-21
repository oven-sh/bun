#include "data_stream.hpp"
#include <cstdlib>
#include <memory>
#include <sys/mman.h>

namespace bun::fuzzilli {

MmapDataStreamBuf::MmapDataStreamBuf(int fd) : m_mapping([&] {
    void* addr = mmap(nullptr, reprlMaxDataSize, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (addr == MAP_FAILED) {
        // TODO(markoejnovic): Log
        std::abort();
    }

    return reinterpret_cast<char*>(addr);
}()) {
    setg(m_mapping, m_mapping, m_mapping + reprlMaxDataSize);
}

MmapDataStreamBuf::~MmapDataStreamBuf() {
    if (m_mapping != nullptr) {
        munmap(m_mapping, reprlMaxDataSize);
    }
}

DataStream DataStream::fromEnv(int dataReadFd) {
    return {
        [dataReadFd] -> std::unique_ptr<DataStreamBuf> {
            if (const char* shmKey = getenv("SHM_ID")) {
                const std::int32_t fd = shm_open(shmKey, O_RDWR, S_IREAD | S_IWRITE);
                if (fd < 0) {
                    // TODO(markoejnovic): Log
                    std::abort();
                }

                return std::make_unique<MmapDataStreamBuf>(fd);
            }

            // Otherwise, we will be reading from the data stream.
            return std::make_unique<FileDataStreamBuf>(dataReadFd);
        }()
    };
}

} // namespace bun::fuzzilli
