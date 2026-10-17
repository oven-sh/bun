void cc_noop(void) {}
void cc_sink(int a) {}
int cc_identity(int a) { return a; }
int cc_add(int a, int b) { return a + b; }
int cc_sum10(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j) {
  return a + b + c + d + e + f + g + h + i + j;
}
double cc_sum_of_squares(double a, double b) { return a * a + b * b; }
_Bool cc_is_null(const void* a) { return a == 0; }
_Bool cc_same(const void* a, const void* b) { return a == b; }
