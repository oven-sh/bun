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

DEPS      := lsquic lsqpack lshpack boringssl hdrhistogram zlib
DEP_DIRS  := $(addprefix $(OBJ)/,$(DEPS))
LIBDEPS   := build/libdeps.a

BIN := h3blast
SRCS := src/h3blast.c src/boringssl_hooks.c

# Bun's debug profile compiles its deps with ASan, so the runtime has to be
# linked in too. Expanded in the recipe, once $(LIBDEPS) exists.
ASAN = $(if $(shell nm -u $(LIBDEPS) | grep -m1 __asan_init),-fsanitize=address)

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

$(BIN): $(SRCS) $(LIBDEPS)
	@echo "  CC    $@"
	@$(CC) $(CFLAGS) $(ASAN) -o $@ $(SRCS) $(LIBDEPS) $(LDFLAGS)

clean:
	rm -f $(BIN) $(LIBDEPS)

.PHONY: all clean
