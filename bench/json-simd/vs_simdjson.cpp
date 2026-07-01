// Standalone tape-vs-tape benchmark: simdjson DOM parse vs Bun's
// highway_json_parse on the same inputs. Both build a flat tape; neither
// builds Bun's Expr AST.
//
// Build (from repo root):
//   clang++ -O3 -march=native -std=c++20 \
//     -I$HOME/code/simdjson/singleheader -Ivendor/highway \
//     bench/json-simd/vs_simdjson.cpp \
//     $HOME/code/simdjson/singleheader/simdjson.cpp \
//     src/jsc/bindings/highway_json.cpp \
//     vendor/highway/hwy/targets.cc vendor/highway/hwy/per_target.cc \
//     vendor/highway/hwy/abort.cc \
//     -o /tmp/vs_simdjson
//
// Run:
//   /tmp/vs_simdjson <iters> <file...>

#include "simdjson.h"
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

extern "C" uint32_t highway_json_parse(const uint8_t* buf, size_t len,
    uint32_t* indices, size_t indices_cap,
    uint64_t* tape, uint8_t* strbuf,
    uint32_t* out_tape_len, uint32_t* out_strbuf_len,
    uint32_t* out_flags, uint32_t* out_err_pos);

using clk = std::chrono::high_resolution_clock;

template<class F>
static double time_ns(int iters, F&& f)
{
    for (int i = 0; i < 3; ++i) f(); // warmup
    auto t0 = clk::now();
    for (int i = 0; i < iters; ++i) f();
    auto t1 = clk::now();
    return std::chrono::duration<double, std::nano>(t1 - t0).count() / iters;
}

// Recursively visit every value in a simdjson DOM — forces every string,
// number, and container to be materialized. This is the work a real consumer
// (e.g. building an AST) has to do on top of `parser.parse()`.
static uint64_t walk_dom(simdjson::dom::element e)
{
    using namespace simdjson::dom;
    uint64_t h = 0;
    switch (e.type()) {
    case element_type::ARRAY:
        for (element child : array(e)) h += walk_dom(child);
        return h + 1;
    case element_type::OBJECT:
        for (auto kv : object(e)) {
            h += kv.key.size();
            h += walk_dom(kv.value);
        }
        return h + 1;
    case element_type::STRING:
        return std::string_view(e).size();
    case element_type::INT64:
        return static_cast<uint64_t>(int64_t(e));
    case element_type::UINT64:
        return uint64_t(e);
    case element_type::DOUBLE: {
        double d = double(e);
        uint64_t b;
        std::memcpy(&b, &d, sizeof b);
        return b;
    }
    case element_type::BOOL:
        return bool(e) ? 1 : 0;
    case element_type::NULL_VALUE:
        return 0;
    }
    return 0;
}

int main(int argc, char** argv)
{
    if (argc < 3) {
        std::fprintf(stderr, "usage: %s <iters> <file...>\n", argv[0]);
        return 1;
    }
    const int iters = std::atoi(argv[1]);
    std::printf("simdjson active impl: %s\n\n", simdjson::get_active_implementation()->name().c_str());
    std::printf("%-24s %9s  %14s  %14s  %14s\n",
        "file", "bytes", "sj tape-only", "sj parse+walk", "bun tape-only");

    for (int a = 2; a < argc; ++a) {
        simdjson::padded_string json;
        if (simdjson::padded_string::load(argv[a]).get(json)) {
            std::fprintf(stderr, "failed to load %s\n", argv[a]);
            continue;
        }
        const size_t len = json.size();

        // simdjson DOM (stage1 + stage2 → tape).
        simdjson::dom::parser parser;
        // Pre-allocate so we measure parsing, not allocation.
        if (parser.allocate(len)) {
            std::fprintf(stderr, "simdjson allocate failed\n");
            continue;
        }
        double ns_sj_tape = time_ns(iters, [&] {
            simdjson::dom::element doc;
            auto err = parser.parse(json).get(doc);
            if (err) std::abort();
        });
        // simdjson parse + visit every value (the work a consumer must do).
        volatile uint64_t sink = 0;
        double ns_sj_walk = time_ns(iters, [&] {
            simdjson::dom::element doc;
            auto err = parser.parse(json).get(doc);
            if (err) std::abort();
            sink += walk_dom(doc);
        });

        // Bun highway_json_parse (stage1 + stage2 → tape). Buffers reused.
        std::vector<uint32_t> idx(len + 64 + 4);
        std::vector<uint64_t> tape(len + len / 2 + 8);
        std::vector<uint8_t> strbuf(len + 32);
        uint32_t tlen, slen, flags, epos;
        double ns_bun = time_ns(iters, [&] {
            uint32_t rc = highway_json_parse(
                reinterpret_cast<const uint8_t*>(json.data()), len,
                idx.data(), idx.size(), tape.data(), strbuf.data(),
                &tlen, &slen, &flags, &epos);
            if (rc != 0) std::abort();
        });

        const char* name = argv[a];
        if (const char* s = std::strrchr(name, '/')) name = s + 1;
        std::printf("%-24s %9zu  %11.0f ns  %11.0f ns  %11.0f ns\n",
            name, len, ns_sj_tape, ns_sj_walk, ns_bun);
    }
    return 0;
}
