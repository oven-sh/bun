// Fixed seeds of fuzz/members-read-beside-an-accessor-that-is-defined-under-another-key.ts: small programs about one object, one member that a descriptor defines on it, and a read of another member,
// whose value is then asked for its kind. An accessor under one key says nothing about what stands under another.
import { generate } from "../../fuzz/members-read-beside-an-accessor-that-is-defined-under-another-key";
import { Random } from "../../fuzz/random";
import { generated } from "../../generated/run-generated";

const onceWrong = [87, 99, 154, 229];

generated(
  "members read beside an accessor that is defined under another key",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of the object would be one more thing known about it.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
