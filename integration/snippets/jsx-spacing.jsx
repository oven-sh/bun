import * as ReactDOM from "react-dom/server";

const Tester = ({ description }) => {
  console.assert(
    description ===
      "foo\nbar \n\nbaz\n\nthis\ntest\n\nchecks\nnewlines\nare\ngood\nyeah\n\n",
    "Expected description to be 'foo\\nbar \\n\\nbaz\\n\\nthis\\ntest\\n\\nchecks\\nnewlines\\nare\\ngood\\nyeah\\n\\n' but was '" +
      description +
      "'"
  );

  return description;
};

export function test() {
  const foo = ReactDOM.renderToString(
    <Tester
      description="foo
  bar 
  
  baz
  
  this
  test
  
  checks
  newlines
  are
  good
  yeah
  
  "
    ></Tester>
  );
  testDone(import.meta.url);
}
