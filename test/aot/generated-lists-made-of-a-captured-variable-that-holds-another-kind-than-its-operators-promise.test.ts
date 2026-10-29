// Fixed seeds of fuzz/lists-made-of-a-captured-variable-that-holds-another-kind-than-its-operators-promise.ts: small programs in which the operators used on a variable, or its declared
// type, promise one kind of value, the variable holds another kind, a closure has captured it, and a list, a view or an object is made of it.
import { generate } from "./fuzz/lists-made-of-a-captured-variable-that-holds-another-kind-than-its-operators-promise";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const onceWrong = [17, 24, 38, 45, 47, 48, 52, 79];

generated(
  "lists made of a captured variable that holds another kind than its operators promise",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: each case stands alone, and what is known of it is the point.
    keepsItsText: true as const,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
