// Test conditional import with "bun" condition (should work)
import { value } from "test-package" with { condition: "bun" };
console.log("Bun condition import:", typeof value);

// Test conditional import with non-matching condition (should be disabled/no-op)  
import { other } from "test-package" with { condition: "nonexistent" };
console.log("Non-matching condition import:", typeof other);

console.log("Test completed successfully!");