// Test to see if our compact sourcemap changes cause any panics
import { StringDecoder } from 'string_decoder';

console.log("Testing StringDecoder with sourcemap...");

const decoder = new StringDecoder('utf8');
const result = decoder.write(Buffer.from('hello world'));
console.log("Result:", result);

// Force an error with sourcemap lookup
try {
    throw new Error("Test error for sourcemap");
} catch (e) {
    console.log("Error caught:", e.message);
    console.log("Stack:", e.stack);
}

console.log("Test completed successfully");