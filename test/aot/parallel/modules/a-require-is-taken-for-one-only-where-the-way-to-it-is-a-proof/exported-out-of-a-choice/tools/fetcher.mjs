const hidden = (value) => [value][JSON.parse("0")];
const given = hidden((name) => "given " + name);
const flag = hidden(false);
export const fetch_ = flag ? require : given;
