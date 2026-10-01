type A<T = string, U extends object = {}> = [T, U];
function f<const T, in out U = T>() {}
