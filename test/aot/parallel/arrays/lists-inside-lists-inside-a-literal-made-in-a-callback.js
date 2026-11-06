function tell(text) {
  console.log(text.length, text.slice(0, 60));
}
function run() {
  try {
    tell(
      JSON.stringify(
        Array.from({ length: 3 }, (unused, index) => ({
          get more() {
            return index;
          },
        })),
      ),
    );
    tell(
      JSON.stringify(
        Array.from({ length: 200 }, (unused, index) => ({
          id: index,
          name: "n" + index + (index === 200 - 1 ? "" : ""),
        })),
        function (key, held) {
          return key === "0"
            ? JSON.stringify(Array.from({ length: 3 }, (unused, index) => [index, [index, [index]]]))
            : held;
        },
      ),
    );
  } catch (error) {
    console.log("THROWS", error.constructor.name);
  }
}
run();
