export const annexB = /\1/;
export const unicode = /\1/u;
export const repeated = /a**/;
export const script = /\p{Script=Nope}/u;
export const category = /\p{General_Category=Nope}/u;
export const escaped = /(?<\u0041>.)\k<A>/;
export const ampersand = /[a&b]/v;
export const control = /[\c1-\x20]/;
