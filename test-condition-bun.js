// Test conditional import with "bun" condition (should work)
import { value } from "test-package" with { condition: "bun" };
console.log("Value from conditional import:", value);