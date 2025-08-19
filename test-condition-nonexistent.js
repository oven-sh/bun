// Test conditional import with non-matching condition (should be no-op)
import { other } from "test-package" with { condition: "nonexistent" };
console.log("This should work if the import is disabled:", typeof other);