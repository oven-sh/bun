// For cc() of bun:ffi in ./a-nan-that-native-code-hands-over.ts.
double compiled_number_of_bits(unsigned upper, unsigned lower) {
  union { unsigned long long bits; double number; } both;
  both.bits = (unsigned long long)upper << 32 | lower;
  return both.number;
}
