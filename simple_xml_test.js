console.log("Simple XML test...");

try {
    const result = Bun.XML.parse("<a>b</a>");
    console.log("Result:", result);
} catch (e) {
    console.log("Error message:", e.message);
}