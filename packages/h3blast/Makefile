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
	@if nm -u $@ | grep -q __asan_init; then \
		rm -f $@; \
		echo "error: the dep objects under $(OBJ) are ASan-instrumented"; \
		echo "       (the default for Bun's debug profile). h3blast is a load"; \
		echo "       generator: run 'bun run build:release' in the repo root,"; \
		echo "       then 'make'"; \
		exit 1; \
	fi

$(BIN): $(SRCS) $(LIBDEPS)
	@echo "  CC    $@"
	@$(CC) $(CFLAGS) -o $@ $(SRCS) $(LIBDEPS) $(LDFLAGS)

clean:
	rm -f $(BIN) $(LIBDEPS)

.PHONY: all clean
