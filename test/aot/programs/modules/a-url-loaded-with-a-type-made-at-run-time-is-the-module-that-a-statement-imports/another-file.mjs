const options = type => ({ with: { type } });
export const loadWhatIsSummed = () =>
  import('data:application/json,{"a":1,"inner":{"x":1}}', options(["js", "on"].join("")));
