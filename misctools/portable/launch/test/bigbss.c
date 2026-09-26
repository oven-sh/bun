// A second test image, for the part of the loader stub that the threaded test
// does not reach: a .bss that is larger than a page, so the stub has to map
// anonymous zero pages after the file pages of the writable segment and to
// zero the rest of the last file page itself.
//
// Prints one line and exits 42 when everything holds.
#include <stdio.h>
#include <string.h>

#define BSS_MB 4
static unsigned char big[BSS_MB << 20];          /* .bss, several pages */
static unsigned char tail_of_data[3] = {1, 2, 3}; /* .data, at the end of the file part */
static unsigned long long started_zero;

int main(void) {
  for (unsigned long long i = 0; i < sizeof big; i++) started_zero += big[i] == 0;
  memset(big, 0xa5, sizeof big);
  unsigned long long written = 0;
  for (unsigned long long i = 0; i < sizeof big; i++) written += big[i] == 0xa5;
  int data_ok = tail_of_data[0] == 1 && tail_of_data[1] == 2 && tail_of_data[2] == 3;
  tail_of_data[1] = 9;
  int data_writable = tail_of_data[1] == 9;
  int ok = started_zero == sizeof big && written == sizeof big && data_ok && data_writable;
  printf("bigbss: bss=%d MiB zero_at_start=%llu written=%llu data_ok=%d data_writable=%d\n", BSS_MB, started_zero, written, data_ok, data_writable);
  return ok ? 42 : 1;
}
