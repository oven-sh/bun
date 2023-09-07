extern "C" {
void *sni_new();
void sni_free(void *sni, void (*cb)(void *user));
int sni_add(void *sni, const char *hostname, void *user);
void *sni_remove(void *sni, const char *hostname);
void *sni_find(void *sni, const char *hostname);
}

#include <assert.h>
#include <stdio.h>

/* Todo: replace 13, 14 and 15 with malloc */
//void *WILDCARD_GOOGLE_COM = strdup("*.google.com");
//void *TEST_GOOGLE_COM = strdup("test.google.com");

void sni_free_cb(void *user) {
	printf("Freeing %p\n", user);
}

int main() {

	void *sni = sni_new();

	/* Adding should succeed */
	assert(sni_add(sni, "*.google.com", 13) == 0);
	assert(sni_add(sni, "test.google.com", 14) == 0);

	/* Adding the same name should not overwrite existing */
	assert(sni_add(sni, "*.google.com", 15) != 0);
	assert(sni_find(sni, "anything.google.com") == 13);

	assert(sni_find(sni, "docs.google.com") == 13);
	assert(sni_find(sni, "*.google.com") == 13);
	assert(sni_find(sni, "test.google.com") == 14);
	assert(sni_find(sni, "yolo.nothing.com") == 0);
	assert(sni_find(sni, "yolo.google.com") == 13);

	/* Removing should work */
	assert(sni_remove(sni, "test.google.com") == 14);
	assert(sni_find(sni, "test.google.com") == 13);
	assert(sni_remove(sni, "*.google.com") == 13);
	assert(sni_find(sni, "test.google.com") == 0);

	/* Removing parent with data should not remove child with data */
	assert(sni_add(sni, "www.google.com", 16) == 0);
	assert(sni_add(sni, "www.google.com.au.ck.uk", 17) == 0);
	assert(sni_find(sni, "www.google.com") == 16);
	assert(sni_find(sni, "www.google.com.au.ck.uk") == 17);
	assert(sni_remove(sni, "www.google.com.yolo") == 0);
	assert(sni_remove(sni, "www.google.com.au.ck.uk") == 17);
	assert(sni_find(sni, "www.google.com") == 16);

	/* Free should not leave anything remaining (test with ASAN leaksanitizer) */
	sni_free(sni, sni_free_cb);

	printf("OK\n");
}
