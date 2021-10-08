# Benchmarking hot module reloading

## Methodology

How do you benchmark hot module reloading? What do you call "done" and what do you call "start"?

The answer for "done" is certainly not compilation time. Compilation time is one step.

I think the answer should be different depending on the type of content loaded.

For CSS, the answer should be "when the updated stylesheet was drawn on the screen"
For JavaScript, the answer should be "when the rebuilt code completed execution such that any changes are applied"
For images & assets, the answer should be "when the updated asset finished loading"

The start time should be defined as "the timestamp the filesystem set as the write time". As in, the time the developer pressed save in their editor.
