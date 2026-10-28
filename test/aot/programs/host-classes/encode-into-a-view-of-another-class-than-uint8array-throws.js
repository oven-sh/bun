// STATISTIC: NativeFunctionsCalledDirectly = 0
// encoder.encodeInto(text, view) where the function that calls also makes the view, so its class is known: a view of another class than Uint8Array makes the call throw a TypeError as in plain Bun, its bytes stay as they were, and the function that takes an address and a count is not entered.
const encoder = new TextEncoder();
const texts = JSON.parse('["hi","é","日本語"]');
const bytesOf = view => Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)).join();
const told = error => "throws " + error.name + " " + error.code + " " + error.message;
function intoFloats(text) { const view = new Float64Array(2); try { return encoder.encodeInto(text, view).written + " written " + bytesOf(view); } catch (error) { return told(error) + " " + bytesOf(view); } }
function intoADataView(text) { const view = new DataView(new ArrayBuffer(8)); try { return encoder.encodeInto(text, view).written + " written " + bytesOf(view); } catch (error) { return told(error) + " " + bytesOf(view); } }
function intoClampedBytes(text) { const view = new Uint8ClampedArray(8); try { return encoder.encodeInto(text, view).written + " written " + bytesOf(view); } catch (error) { return told(error) + " " + bytesOf(view); } }
function intoSignedBytes(text) { const view = new Int8Array(8); try { return encoder.encodeInto(text, view).written + " written " + bytesOf(view); } catch (error) { return told(error) + " " + bytesOf(view); } }
function intoShorts(text) { const view = new Uint16Array(4); try { return encoder.encodeInto(text, view).written + " written " + bytesOf(view); } catch (error) { return told(error) + " " + bytesOf(view); } }
function intoBigIntegers(text) { const view = new BigInt64Array(1); try { return encoder.encodeInto(text, view).written + " written " + bytesOf(view); } catch (error) { return told(error) + " " + bytesOf(view); } }
function intoAPartOfSignedBytes(text) { const view = new Int8Array(8); try { return encoder.encodeInto(text, view.subarray(2)).written + " written " + bytesOf(view); } catch (error) { return told(error) + " " + bytesOf(view); } }
function convertedFirst(view) { const order = []; try { encoder.encodeInto({ toString() { order.push("text"); return "hi"; } }, view); } catch (error) { order.push(error.name); } return order.join(); }
function nobodyReadsTheCounts() { const view = new Float64Array(2); encoder.encodeInto("hi", view); return "returned " + bytesOf(view); }
const lines = [];
for (const text of texts) for (const into of [intoFloats, intoADataView, intoClampedBytes, intoSignedBytes, intoShorts, intoBigIntegers, intoAPartOfSignedBytes]) lines.push(into.name + " " + JSON.stringify(text) + " " + into(text));
lines.push("converted first " + convertedFirst(new Float64Array(2)));
try { lines.push(nobodyReadsTheCounts()); } catch (error) { lines.push("nobody reads the counts: " + told(error)); }
console.log(lines.join("\n"));
