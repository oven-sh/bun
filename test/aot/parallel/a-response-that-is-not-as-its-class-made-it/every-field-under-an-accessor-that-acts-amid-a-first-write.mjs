// every-field-under-an-accessor-that-acts-amid-end.mjs, for another call.
process.env.CALL = "first write";
await import("./every-field-under-an-accessor-that-acts-amid-end.mjs");
