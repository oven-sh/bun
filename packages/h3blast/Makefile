# h3blast — links against Bun's already-built vendored deps so we don't
# rebuild lsquic/BoringSSL/HdrHistogram. Run `bun run build:release` once
# in the repo root first so the .o files exist.

ROOT      := ../..
PROFILE   ?= release
OBJ       := $(ROOT)/build/$(PROFILE)/obj/vendor
VENDOR    := $(ROOT)/vendor

CC        ?= clang
# LSXPACK_MAX_STRLEN must match scripts/build/flags.ts: the linked
# build/$(PROFILE)/obj/vendor/{lsquic,lsqpack,lshpack} objects are compiled
# with the 32-bit lsxpack_strlen_t layout.
CFLAGS    := -std=c11 -O3 -g -Wall -Wextra -Wno-unused-parameter \
             -DLSXPACK_MAX_STRLEN=UINT32_MAX \
             -I$(VENDOR)/lsquic/include \
             -I$(VENDOR)/hdrhistogram/include \
             -I$(VENDOR)/boringssl/include
LDFLAGS   := -lstdc++ -lm -lpthread

DEPS      := lsquic lsqpack lshpack boringssl hdrhistogram zlib
DEP_DIRS  := $(addprefix $(OBJ)/,$(DEPS))
LIBDEPS   := build/libdeps.a

BIN := h3blast

all: $(BIN)

$(LIBDEPS):
	@if [ ! -d "$(OBJ)/lsquic" ]; then \
		echo "error: no dep objects found under $(OBJ)"; \
		echo "       run 'bun run build:$(PROFILE)' in the repo root first"; \
		exit 1; \
	fi
	@mkdir -p build
	@echo "  AR    $@"
	@find $(DEP_DIRS) -name '*.o' | xargs ar rcs $@

$(BIN): src/h3blast.c $(LIBDEPS)
	@echo "  CC    $@"
	@$(CC) $(CFLAGS) -o $@ $< $(LIBDEPS) $(LDFLAGS)

clean:
	rm -f $(BIN) $(LIBDEPS)

.PHONY: all clean
