# CSS Stress Test

This benchmarks bundler performance for CSS hot reloading.

## Results

bun is 14x faster than Next.js at hot reloading CSS.

```
 bun v0.0.34
 Saving every 16ms

 Frame time:
 50th percentile: 22.2ms
 75th percentile: 23.9ms
 90th percentile: 25.3ms
 95th percentile: 43.6ms
 99th percentile: 49.1ms
 Rendered frames: 922 / 1024 (90%)
```

```
 Next.js v11.1.2
 Saving every 16ms

 Frame time:
 50th percentile: 312ms
 75th percentile: 337.6ms
 90th percentile: 387.7ms
 95th percentile: 446.9ms
 99th percentile: 591.7ms
 Rendered frames: 64 / 1024 (6%)
```

## How it works

It times pixels instead of builds. `color-looper.zig` writes color updates and the timestamp to a css file, while simultaneously screen recording a non-headless Chromium instance. After it finishes, it OCRs the video frames and verifies the scanned timestamps against the actual data. This data measures (1) how long each update took from saving to disk up to the pixels visible on the screen and (2) what % of frames were rendered.

The intent is to be as accurate as possible. Measuring times reported client-side is simpler, but lower accuracy since those times may not correspond to pixels on the screen and do not start from when the data was written to disk (at best, they measure when the filesystem watcher detected the update, but often not that either). `color-looper.zig` must run separately from `browser.js` or the results will be inaccurate.

It works like this:

1. `browser.js` loads either bun or Next.js and a Chromium instance opened to the correct webpage
2. `color-looper.zig` updates [`./src/colors.css`](./src/colors.css) in a loop up to `1024` times (1024 is arbitrary), sleeping every `16`ms or `32`ms (a CLI arg you can pass it). The `var(--timestamp)` CSS variable contains the UTC timestamp with precision of milliseconds and one extra decimal point
3. `color-looper.zig` automatically records the screen via `screencapture` (builtin on macOS) and saves it, along with a `BigUint64Array` containing all the expected timestamps. When it's done, it writes to a designated file on disk which `browser.js` picks up as the signal to close the browser.
4. `ffmpeg` converts each frame into a black and white `.tif` file, which `tesseract` then OCRs
5. Various cleanup scripts extract the timestamp from each of those OCR'd frames into a single file
6. Using the OCR'd data, `./read-frames.js` calculates the 50th, 75th, 90th, 95th, and 99th percentile frame time, along with how many frames were skipped. Frame time is the metric here that matters here because that's how much time elapsed between each update. It includes the artificial sleep interval, so it will not be faster than the sleep interval.

The script `run.sh` runs all the commands necessary to do this work unattended. It takes awhile though. The slow part is OCR'ing all the frames.

To run this, you need:

- `zig`
- `bun-cli`
- `node`
- `tesseract`
- `screencapture` (macOS builtin)
- `ffmpeg`
- `puppeteer` (from the package.json)

You will need to run `bun bun --use next` first, with `next@11.1.2`. It will only run on macOS due to the dependencies on `screencapture`, how it detects screen resolution (so that Chromium is maximized), and how it auto-focuses Chromium (apple script)
