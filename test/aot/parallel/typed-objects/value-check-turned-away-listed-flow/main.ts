// A value a check turned away is listed in a literal whose field flow has proven.
import { FIRST_TITLE, SECOND_TITLE, FIRST_ANSWER, SECOND_ANSWER } from "./texts.ts";

function pickText({ title, answer }: { title: string; answer: string }): string {
  return `${title}: ${answer}`;
}

function build({ title, answer, pickAnswer }: { title: string; answer: string; pickAnswer?: (count: number) => string | undefined }) {
  const texts = { title, answer };
  return {
    show() {
      return pickText(texts);
    },
    call(count: number) {
      const picked = pickAnswer?.(count);
      return pickText({ ...texts, answer: picked ?? answer });
    },
  };
}

const first = build({
  title: FIRST_TITLE,
  answer: FIRST_ANSWER,
  pickAnswer(count) {
    return count > 1 ? "picked" : undefined;
  },
});
const second = build({ title: SECOND_TITLE, answer: SECOND_ANSWER });

for (const gadget of [first, second]) console.log(gadget.show(), "|", gadget.call(1), "|", gadget.call(2));
