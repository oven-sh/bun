import assert from "assert";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

if(process.platform !== 'win32') {
    console.log('This script is only intended to be run on Windows.');
    process.exit(1);
}

process.chdir(join(fileURLToPath(import.meta.url), '../../../../'));

const test_report = JSON.parse(readFileSync('test-report.json', 'utf8'));
assert(Array.isArray(test_report.failing_tests));

for (const { path, reason, expected_crash_reason } of test_report.failing_tests) {
    assert(path);
    assert(reason);
    
    if(expected_crash_reason !== reason) {
        const old_content = readFileSync(path, 'utf8');

        let content = old_content.replace(/\/\/\s*@bun-known-failing-on-windows:.*\n/, '')
        if (reason) {
            content = `// @bun-known-failing-on-windows: ${reason}\n` + content;
        }

        if (content !== old_content) {
            writeFileSync(path, content, 'utf8');
            console.log(path);
        } 
    }
}