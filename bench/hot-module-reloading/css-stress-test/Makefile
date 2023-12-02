SLEEP_INTERVAL ?= 32
SCREEN_WIDTH ?= $(shell system_profiler -json SPDisplaysDataType 2>/dev/null | jq -r '.. | objects | select(.spdisplays_main) | ._spdisplays_pixels | split(" ")[0]')
SCREEN_HEIGHT ?= $(shell system_profiler -json SPDisplaysDataType 2>/dev/null | jq -r '.. | objects | select(.spdisplays_main) | ._spdisplays_pixels | split(" ")[2]')
PROJECT ?= bun
PACKAGE_NAME ?= bun-cli
RUN_COUNT ?= 128
ENDPOINT ?= /

ifeq ($(PROJECT),bun)
PACKAGE_NAME := bun-cli
endif

ifeq ($(PROJECT),next)
PACKAGE_NAME := next
endif

generate:
	@killall -9 bun next node || echo ""
	PROJECT=$(PROJECT) SCREEN_WIDTH=$(SCREEN_WIDTH) SCREEN_HEIGHT=$(SCREEN_HEIGHT) ENDPOINT=$(ENDPOINT) node browser.js 

generate-css-in-js:
	@killall -9 bun next node || echo ""
	PROJECT=$(PROJECT) SCREEN_WIDTH=$(SCREEN_WIDTH) SCREEN_HEIGHT=$(SCREEN_HEIGHT) ENDPOINT=/css-in-js node browser.js 
loop:
	cp src/colors.css.0 src/colors.css
	sleep 3
	osascript -e 'tell application "System Events" to tell process "Chromium"' \
		-e 'set frontmost to true' \
		-e 'if windows is not {} then perform action "AXRaise" of item 1 of windows' \
		-e 'end tell'
	sleep 0.5
	cd src; zig run -Doptimize=ReleaseFast ../color-looper.zig -- ./colors.css:0 $(SLEEP_INTERVAL)
	cp src/colors.css.blob $(PROJECT)/colors.css.blob

loop-emotion:
	cp src/css-in-js-styles.0 src/css-in-js-styles.tsx
	sleep 3
	osascript -e 'tell application "System Events" to tell process "Chromium"' \
		-e 'set frontmost to true' \
		-e 'if windows is not {} then perform action "AXRaise" of item 1 of windows' \
		-e 'end tell'
	sleep 0.5
	cd src; zig run -Doptimize=ReleaseFast ../color-looper.emotion.zig -- ./css-in-js-styles.tsx:0 $(SLEEP_INTERVAL)
	cp src/css-in-js-styles.tsx.blob $(PROJECT)/css-in-js-styles.blob

process_video: 
	rm -rf $(FRAMES_DIR); mkdir -p $(FRAMES_DIR); ffmpeg -i src/colors.css.mov -vf fps=120,format=gray $(FRAMES_DIR)/%d.tif

FRAMES_DIR ?= $(shell mkdir -p ./$(PROJECT)/frames; realpath ./$(PROJECT)/frames)

TIF_FILES := $(wildcard $(FRAMES_DIR)/*.tif)
TXT_FILES := $(wildcard $(FRAMES_DIR)/*.txt)

OBJ_FILES := $(patsubst $(SRC_DIR)/%.tif,$(OBJ_DIR)/%.txt,$(TIF_FILES))
TRIM_FILES := $(patsubst $(SRC_DIR)/%.txt,$(OBJ_DIR)/%.trim,$(TXT_FILES))

frames: $(OBJ_FILES)


$(FRAMES_DIR)/%.txt: $(FRAMES_DIR)/%.tif
	 tesseract -l eng $< $@ 

trim: $(TRIM_FILES) cleanup print



$(FRAMES_DIR)/%.trim: $(FRAMES_DIR)/%.txt
	 (grep "Ran:" $< || echo "\n") >> $(PROJECT)/frames.all

cleanup:
	sed 's/^Ran: *//' $(PROJECT)/frames.all | tr -d ' ' | sort | uniq > $(PROJECT)/frames.all.clean

print:
	PACKAGE_NAME=$(PACKAGE_NAME) SLEEP_INTERVAL=$(SLEEP_INTERVAL) PROJECT=$(PROJECT) OUTFILE=timings/$(PACKAGE_NAME) node read-frames.js 

print-emotion:
	PACKAGE_NAME=$(PACKAGE_NAME) SLEEP_INTERVAL=$(SLEEP_INTERVAL) PROJECT=$(PROJECT) OUTFILE=timings/emotion_$(PACKAGE_NAME) node read-frames.js 