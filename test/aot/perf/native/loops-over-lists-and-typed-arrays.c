// The loops of test/aot/perf/everyday/loops-over-lists-and-typed-arrays.txt in C: the same element types, data on the heap behind
// globals whose lengths are known at run time only, no bounds checks (the language has none). clang -O2.
// loops <name>: AOT_PERF_TURNS turns of that loop.
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define TURN __attribute__((noinline)) static double

static double *left, *right; static size_t left_length, right_length;
TURN float64_dot_product_of_a_thousand(int i) {
    double sum = i & 1;
    for (size_t k = 0; k < left_length; k++) sum += left[k] * right[k];
    return sum;
}
static int32_t *counts; static size_t counts_length;
TURN int32_array_sum_of_a_thousand(int i) {
    int64_t sum = i & 1;
    for (size_t k = 0; k < counts_length; k++) sum += counts[k];
    return sum;
}
static float *levels; static size_t levels_length;
TURN float32_array_scaled_in_place(int i) {
    double factor = i & 1 ? 2 : 0.5;
    for (size_t k = 0; k < levels_length; k++) levels[k] = levels[k] * factor;
    return levels[i & 511];
}
static uint8_t *from, *to; static size_t from_length;
TURN uint8_array_copied_by_index(int i) {
    for (size_t k = 0; k < from_length; k++) to[k] = from[k];
    return to[i & 511];
}
static uint8_t *bytes; static size_t bytes_length; static int32_t *bins;
TURN uint8_array_counted_into_bins(int i) {
    for (size_t k = 0; k < bytes_length; k++) bins[bytes[k]]++;
    return bins[i & 255] & 1023;
}
static uint8_t *pixels; static size_t pixels_length;
TURN uint8_clamped_array_brightened(int i) {
    int by = i & 1 ? 9 : -9;
    for (size_t k = 0; k < pixels_length; k++) { int v = pixels[k] + by; pixels[k] = v < 0 ? 0 : v > 255 ? 255 : v; }
    return pixels[i & 511];
}
static uint16_t *heights; static size_t heights_length;
TURN uint16_array_greatest_of_a_thousand(int i) {
    int greatest = i & 1;
    for (size_t k = 0; k < heights_length; k++) { int height = heights[k]; if (height > greatest) greatest = height; }
    return greatest;
}
static double *signal_, *smooth; static size_t signal_length;
TURN float64_array_mean_of_three_neighbors(int i) {
    for (size_t k = 1; k < signal_length - 1; k++) smooth[k] = (signal_[k - 1] + signal_[k] + signal_[k + 1]) / 3;
    return smooth[(i & 511) + 1];
}
static double *steps, *sums; static size_t steps_length;
TURN float64_array_running_sums(int i) {
    sums[0] = steps[0] + (i & 1);
    for (size_t k = 1; k < steps_length; k++) sums[k] = sums[k - 1] + steps[k];
    return sums[511];
}
static int32_t *order; static size_t order_length;
TURN int32_array_reversed_in_place(int i) {
    for (ptrdiff_t low = 0, high = (ptrdiff_t)order_length - 1; low < high; low++, high--) { int32_t kept = order[low]; order[low] = order[high]; order[high] = kept; }
    return order[i & 511];
}
static double *depths; static size_t depths_length;
TURN float64_array_walked_downward(int i) {
    double sum = i & 1;
    for (ptrdiff_t k = (ptrdiff_t)depths_length - 1; k >= 0; k--) sum += depths[k];
    return sum;
}
enum { side = 16 };
static double *table, *turned;
TURN float64_matrix_transposed_flat(int i) {
    for (int r = 0; r < side; r++) for (int c = 0; c < side; c++) turned[c * side + r] = table[r * side + c];
    return turned[i & 255];
}
static double *samples; static size_t samples_length;
__attribute__((noinline)) static double total(const double* list, size_t length, double first) {
    double sum = first;
    for (size_t k = 0; k < length; k++) sum += list[k];
    return sum;
}
TURN float64_array_in_a_parameter(int i) { return total(samples, samples_length, i & 1); }
struct Series { double* samples; size_t length; };
static struct Series* series;
TURN float64_array_in_a_field(int i) {
    struct Series* self = series;
    double sum = i & 1;
    for (size_t k = 0; k < self->length; k++) sum += self->samples[k];
    return sum;
}
TURN float64_array_that_a_closure_captured(int i) { return float64_array_in_a_field(i); }
static struct Series* rows; static size_t rows_length;
TURN rows_of_float64_arrays(int i) {
    double sum = i & 1;
    for (size_t r = 0; r < rows_length; r++) { struct Series row = rows[r]; for (size_t c = 0; c < row.length; c++) sum += row.samples[c]; }
    return sum;
}
static int64_t *integers; static size_t integers_length;
TURN list_of_integers_sum_of_a_thousand(int i) {
    int64_t sum = i & 1;
    for (size_t k = 0; k < integers_length; k++) sum += integers[k];
    return sum;
}
TURN list_of_fractions_sum_of_a_thousand(int i) {
    double sum = i & 1;
    for (size_t k = 0; k < samples_length; k++) sum += samples[k];
    return sum;
}
static int64_t *marks; static size_t marks_length;
TURN list_of_integers_stored_to_in_place(int i) {
    for (size_t k = 0; k < marks_length; k++) marks[k] = (marks[k] + i) & 1023;
    return marks[i & 511];
}
struct Item { int64_t worth; const char* name; };
static struct Item** items; static size_t items_length;
TURN list_of_objects_one_field_summed(int i) {
    int64_t sum = i & 1;
    for (size_t k = 0; k < items_length; k++) sum += items[k]->worth;
    return sum;
}
__attribute__((noinline)) static int64_t total_of_integers(const int64_t* list, size_t length, int64_t first) {
    int64_t sum = first;
    for (size_t k = 0; k < length; k++) sum += list[k];
    return sum;
}
TURN list_of_integers_in_a_parameter(int i) { return total_of_integers(integers, integers_length, i & 1); }
static uint8_t* view; static size_t view_length;
TURN data_view_sum_of_floats(int i) {
    double sum = i & 1;
    for (size_t at = 0; at < view_length; at += 8) { double value; memcpy(&value, view + at, 8); sum += value; }
    return sum;
}
static uint8_t* packet; static size_t packet_length;
TURN buffer_sum_of_a_thousand(int i) {
    int64_t sum = i & 1;
    for (size_t k = 0; k < packet_length; k++) sum += packet[k];
    return sum;
}
TURN buffer_values_summed(int i) { return buffer_sum_of_a_thousand(i); }
TURN buffer_entries_summed(int i) {
    int64_t sum = i & 1;
    for (size_t k = 0; k < packet_length; k++) sum += packet[k] * (k & 1);
    return sum;
}
static char* line; static size_t line_length;
TURN text_sum_of_char_codes(int i) {
    int64_t sum = i & 1;
    for (size_t k = 0; k < line_length; k++) sum += (uint8_t)line[k];
    return sum;
}

static double* fractions(size_t n, double scale, double plus) { double* a = malloc(n * 8); for (size_t k = 0; k < n; k++) a[k] = k / scale + plus; return a; }

#define EACH(X) X(float64_dot_product_of_a_thousand) X(int32_array_sum_of_a_thousand) X(float32_array_scaled_in_place) X(uint8_array_copied_by_index) X(uint8_array_counted_into_bins) \
    X(uint8_clamped_array_brightened) X(uint16_array_greatest_of_a_thousand) X(float64_array_mean_of_three_neighbors) X(float64_array_running_sums) X(int32_array_reversed_in_place) \
    X(float64_array_walked_downward) X(float64_matrix_transposed_flat) X(float64_array_in_a_parameter) X(float64_array_in_a_field) X(float64_array_that_a_closure_captured) X(rows_of_float64_arrays) \
    X(list_of_integers_sum_of_a_thousand) X(list_of_fractions_sum_of_a_thousand) X(list_of_integers_stored_to_in_place) X(list_of_objects_one_field_summed) X(list_of_integers_in_a_parameter) \
    X(data_view_sum_of_floats) X(buffer_sum_of_a_thousand) X(buffer_values_summed) X(buffer_entries_summed) X(text_sum_of_char_codes)

int main(int argc, char** argv) {
    left = fractions(left_length = 1000, 3, 0); right = malloc(8000); right_length = 1000; for (int k = 0; k < 1000; k++) right[k] = 1 - k / 7.0;
    counts = malloc(4000); counts_length = 1000; for (int k = 0; k < 1000; k++) counts[k] = k * 3;
    levels = malloc(2048); levels_length = 512; for (int k = 0; k < 512; k++) levels[k] = k / 5.0;
    from = malloc(512); to = calloc(512, 1); from_length = 512; for (int k = 0; k < 512; k++) from[k] = k;
    bytes = malloc(512); bytes_length = 512; bins = calloc(256, 4); for (int k = 0; k < 512; k++) bytes[k] = k * 7;
    pixels = malloc(512); pixels_length = 512; for (int k = 0; k < 512; k++) pixels[k] = k > 255 ? 255 : k;
    heights = malloc(2000); heights_length = 1000; for (int k = 0; k < 1000; k++) heights[k] = k * 7919;
    signal_ = fractions(signal_length = 514, 3, 0); smooth = calloc(514, 8);
    steps = fractions(steps_length = 512, 9, 0); sums = calloc(512, 8);
    order = malloc(2048); order_length = 512; for (int k = 0; k < 512; k++) order[k] = k;
    depths = fractions(depths_length = 1000, 3, 0);
    table = fractions(side * side, 3, 0); turned = calloc(side * side, 8);
    samples = fractions(samples_length = 1000, 3, 0.25);
    series = malloc(sizeof *series); series->samples = samples; series->length = 1000;
    rows = malloc(16 * sizeof *rows); rows_length = 16; for (int r = 0; r < 16; r++) { rows[r].samples = fractions(64, 3, r); rows[r].length = 64; }
    integers = malloc(8000); integers_length = 1000; for (int k = 0; k < 1000; k++) integers[k] = k * 3;
    marks = malloc(4096); marks_length = 512; for (int k = 0; k < 512; k++) marks[k] = k;
    items = malloc(4096); items_length = 512; for (int k = 0; k < 512; k++) { items[k] = malloc(sizeof **items); items[k]->worth = k; items[k]->name = "item"; }
    view = (uint8_t*)fractions(512, 3, 0); view_length = 4096;
    packet = malloc(1000); packet_length = 1000; memset(packet, 7, 1000);
    line = malloc(12 * 44 + 1); line[0] = 0; for (int k = 0; k < 12; k++) strcat(line, "the quick brown fox jumps over the lazy dog "); line_length = strlen(line);

    double (*turn)(int) = 0;
    char name[128]; snprintf(name, sizeof name, "%s", argv[1]); for (char* c = name; *c; c++) if (*c == '-') *c = '_';
#define X(f) if (!strcmp(name, #f)) turn = f;
    EACH(X)
    if (!turn) { fprintf(stderr, "no such loop: %s\n", argv[1]); return 1; }
    long n = atol(getenv("AOT_PERF_TURNS")); int32_t sum = 0;
    for (long i = 0; i < n; i++) sum = (int32_t)(int64_t)(sum + turn((int)i));
    printf("%d\n", sum);
    return 0;
}
