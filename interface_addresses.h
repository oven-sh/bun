#ifndef INTERFACE_ADDRESSES_LIB
#define INTERFACE_ADDRESSES_LIB

typedef struct {
    char *interface;
    char *address;
    char *netmask;
    char *family;
    char *mac;
    int internal;
} NetworkInterface;

NetworkInterface *getNetworkInterfaces();
int getNetworkInterfaceArrayLen(NetworkInterface *arr);
char **getNetworkInterfaceNames();
int getNetworkInterfaceNameArrayLen(char **arr);

#endif