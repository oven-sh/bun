# This is the GNU Make shim for Linux and macOS

DESTDIR ?=
prefix ?= /usr/local

examples: default
	./build examples

clean: default
	./build clean

capi: default
	./build capi

install:
	mkdir -p "$(DESTDIR)$(prefix)/include/uWebSockets"
	cp -r src/* "$(DESTDIR)$(prefix)/include/uWebSockets"

all: default
	./build all

default:
	$(MAKE) -C uSockets
	$(CC) build.c -o build
