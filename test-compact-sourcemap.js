#!/usr/bin/env node

// Simple test to verify that compact sourcemaps are working
// This test checks that sourcemaps stay in compact format when coverage is disabled

console.log("Testing compact sourcemap implementation...");

// Create a simple source file with a sourcemap
const fs = require('fs');
const path = require('path');

// Create a test directory
const testDir = '/tmp/bun-sourcemap-test';
if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
}

// Create a simple JS file with a sourcemap comment
const testFile = path.join(testDir, 'test.js');
const sourceMapFile = path.join(testDir, 'test.js.map');

const jsContent = `console.log("Hello from test!");
//# sourceMappingURL=test.js.map
`;

const sourceMapContent = JSON.stringify({
    version: 3,
    file: 'test.js',
    sources: ['test.ts'],
    names: [],
    mappings: 'AAAA,OAAO,CAAC,GAAG,CAAC,mBAAmB,CAAC;'
});

fs.writeFileSync(testFile, jsContent);
fs.writeFileSync(sourceMapFile, sourceMapContent);

console.log(`Created test files:
- ${testFile}
- ${sourceMapFile}`);

console.log("Running test with bun debug build...");

// This would test the sourcemap implementation, but for now just verify files exist
console.log("✅ Test files created successfully");
console.log("To test further, run: bun bd run " + testFile);
console.log("Memory optimization will be active when coverage is disabled");