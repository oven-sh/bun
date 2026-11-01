const re = /a/g;
export const step = s => re.exec(s) && re.lastIndex;
export const read = () => re;
