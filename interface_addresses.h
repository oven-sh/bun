#ifndef INTERFACE_ADDRESSES_LIB
#define INTERFACE_ADDRESSES_LIB

typedef struct {
    char *interface;
    char *address;
    char *family;
} NetworkInterface;

NetworkInterface *getNetworkInterfaces();
int getNetworkInterfaceArrayLen(NetworkInterface *arr);

#endif