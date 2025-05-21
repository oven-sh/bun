import { bench, run } from "../runner.mjs";

const input =
  "Hello, World! foo bar baz qux quux corge grault garply waldo fred plugh xyzzy thud z a b c d e f g h i j k l m n o p q r s t u v w x y z".split(
    " ",
  );

bench(`Array.indexOf`, () => {
  return input.indexOf("thud");
});

await run();
