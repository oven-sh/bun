#ifndef INTERFACE_ADDRESSES_LIB
#define INTERFACE_ADDRESSES_LIB

extern "C" {
    
    typedef struct {
        char *interface;
        char *address;
        char *netmask;
        char *family;
        char *mac;
        uint32_t scopeid;
        int internal;
    } NetworkInterface;

    NetworkInterface *getNetworkInterfaces();
    int getNetworkInterfaceArrayLen(NetworkInterface *arr);
    }

#endif