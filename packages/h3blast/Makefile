# h3blast — links against Bun's already-built vendored deps so we don't
# rebuild lsquic/BoringSSL/HdrHistogram. Run `bun run build:release` once
# in the repo root first so the .o files exist.

ROOT      := ../..
PROFILE   ?= release
OBJ       := $(ROOT)/build/$(PROFILE)/obj/vendor
VENDOR    := $(ROOT)/vendor

CC        ?= clang
CFLAGS    := -std=c11 -O3 -g -Wall -Wextra -Wno-unused-parameter \
             -I$(VENDOR)/lsquic/include \
             -I$(VENDOR)/hdrhistogram/include \
             -I$(VENDOR)/boringssl/include
LDFLAGS   := -lstdc++ -lm -lpthread

DEP_OBJS  := $(wildcard $(OBJ)/lsquic/src/liblsquic/*.o) \
             $(wildcard $(OBJ)/lsquic/*.o) \
             $(wildcard $(OBJ)/lshpack/*.o) \
             $(wildcard $(OBJ)/lshpack/deps/xxhash/*.o) \
             $(wildcard $(OBJ)/boringssl/*.o) \
             $(wildcard $(OBJ)/boringssl/**/*.o) \
             $(wildcard $(OBJ)/hdrhistogram/src/*.o) \
             $(wildcard $(OBJ)/zlib/*.o) \
             $(wildcard $(OBJ)/zlib/**/*.o)

# Wildcards above are not recursive in POSIX make; collect with find instead.
DEP_OBJS  := $(shell find $(OBJ)/lsquic $(OBJ)/lsqpack $(OBJ)/lshpack \
                          $(OBJ)/boringssl $(OBJ)/hdrhistogram $(OBJ)/zlib \
                          -name '*.o' 2>/dev/null)

BIN := h3blast

all: $(BIN)

$(BIN): src/h3blast.c
	@if [ -z "$(DEP_OBJS)" ]; then \
		echo "error: no dep objects found under $(OBJ)"; \
		echo "       run 'bun run build:$(PROFILE)' in the repo root first"; \
		exit 1; \
	fi
	$(CC) $(CFLAGS) -o $@ $< $(DEP_OBJS) $(LDFLAGS)

clean:
	rm -f $(BIN)

.PHONY: all clean
