// Debug XML parsing step by step
console.log("Testing Bun.XML.parse availability...");
console.log("Bun.XML:", Bun.XML);
console.log("Bun.XML.parse:", typeof Bun.XML.parse);

// Test with a very simple XML
const simpleXml = "<test>value</test>";
console.log("Input XML:", JSON.stringify(simpleXml));
console.log("XML length:", simpleXml.length);
console.log("First char:", simpleXml[0], "code:", simpleXml.charCodeAt(0));

try {
    console.log("Attempting to parse...");
    const result = Bun.XML.parse(simpleXml);
    console.log("Success! Result:", JSON.stringify(result, null, 2));
} catch (err) {
    console.error("Error details:");
    console.error("Message:", err.message);
    console.error("Stack:", err.stack);
}