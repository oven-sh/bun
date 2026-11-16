process.argv.splice(1, 1);
        import { expect, mock } from "bun:test";

        const m = mock(i => ({ tag: "ret-" + i, payload: [i] }));
        for (let i = 0; i < 50; i++) m(i);

        let reads = 0;
        const expected = {
          get tag() {
            if (++reads === 45) {
              m.mock.results.length = 0;
              Bun.gc(true);
            }
            return "no match";
          },
          payload: [],
        };

        let message = "";
        try {
          expect(m).toHaveReturnedWith(expected);
        } catch (e) {
          message = e.message;
        }
        console.log(message);
      